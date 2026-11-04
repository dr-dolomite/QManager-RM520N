---
name: qcmd-passthrough-branch-exits-zero
description: qcmd's third case arm passes non-empty output with no OK and no ERROR through at exit 0 — the ONE way a failed AT write reports success, since every other failure is rc=1 + empty stdout
metadata:
  type: reference
---

`qcmd` (`scripts/usr/bin/qcmd`, final `case "$result"` block) has THREE arms, not two:

1. `*ERROR*)` → `output_result "" "command_failed"` → **rc=1, stdout empty, stderr `ERROR: command_failed`**
2. `*OK*)` → echo the raw response (starts with the command echo) → rc=0
3. `*)` → if `$result` is empty: rc=1. **Otherwise it passes the output through at rc=0** with the comment "Some commands return data without OK … let the caller decide."

Arm 3 is the only path where a command the modem never confirmed still exits 0 with non-empty stdout. Every `rc`/`-z` guard in the CGI layer is blind to it, and so is every `case … *ERROR*` branch (that text never reaches stdout). A truncated/timed-out `atcli_smd11` read that returns only the echo line lands here.

**Why:** this is the residue of the "empty stdout ⇔ failure" contract. That contract is TRUE for arms 1 and 2 and FALSE for arm 3, so "check rc, that's enough" is right ~99% of the time and silently wrong in exactly the window where a write half-completed.

**How to apply:** when auditing an AT consumer for false-success, `rc -ne 0 || -z "$result"` is *sufficient* detection for a QUERY (a caller that then parses the payload will notice the missing lines). For a WRITE it is not — nothing downstream re-reads. A write needs a positive assertion that the response contains `OK` (or a read-back), not just a non-empty string. Related: [[at_mutex_duty_cycle_and_contention_recipe]] (qcmd echoes the command on success), [[urc_capture_impossible_no_smd11_listener]].

Measured 2026-08-23 on the live RM520N-GL:
- `qcmd 'AT+QNWPREFCFG="definitely_not_a_real_key"'` → rc=1, stdout `[]`, stderr `[ERROR: command_failed]`
- `qcmd 'AT+QQQNOTREAL?'` → identical
