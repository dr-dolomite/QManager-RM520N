---
name: at-mutex-duty-cycle-and-contention-recipe
description: AT mutex is free ~99.97% of the time (measured 1/3053 samples busy over 30s), so poller contention is effectively zero — plus the safe read-only recipe to force qcmd lock-timeout on a live modem
metadata:
  type: reference
---

## Measured duty cycle of `/tmp/qmanager_at.lock`

Measured 2026-08-14 on the live test modem with the poller active:

```sh
end=$(awk '{print int($1)+30}' /proc/uptime); busy=0; tot=0
while [ "$(awk '{print int($1)}' /proc/uptime)" -lt "$end" ]; do
  tot=$((tot+1))
  ( flock -x -n 9 ) 9</tmp/qmanager_at.lock 2>/dev/null || busy=$((busy+1))
done
echo "samples=$tot busy=$busy"     # -> samples=3053 busy=1
```

**~0.03% busy.** Individual AT reads are ~0.03-0.09s (even 8-command compounds),
and the poller sleeps between every command, so the poller alone will essentially
never make another consumer hit `qcmd`'s 5s `LOCK_WAIT_SHORT`.

**How to apply:** when someone worries that "adding one more AT read will contend
with the poller," the answer is no — it's noise. The only realistic >5s lock holder
is `AT+QSCAN` (cell scanner), which `qcmd` classifies via `is_long_command`.
Reason about contention in terms of QSCAN, never in terms of the poller.

## Safe read-only way to force lock contention

Do NOT issue a real `AT+QSCAN` to induce contention (it's heavy and disturbs the
radio). Hold the flock with a bare sleep instead — no AT command is ever sent:

```sh
( flock -x 9; sleep 16 ) 9</tmp/qmanager_at.lock &
```

A read-only fd (`9<`) is sufficient for `flock -x` (see
[[tmp_ownership_protected_regular_facts]]). While held, every `qcmd` call waits
5s then returns empty stdout + rc=1 + `ERROR: modem_busy` on stderr. Harmless:
the poller just logs a failed cycle and recovers on the next tick.

## `qcmd` stdout is unambiguous

On success `qcmd` echoes the command line back before the payload, so a
successful read is **never** empty. Empty stdout ⇔ failure ⇔ rc=1, for all three
failure modes (lock timeout, modem ERROR, empty/malformed response). Callers that
do `raw=$(qcmd ... 2>/dev/null)` can therefore distinguish failure from
success-but-empty by checking `$?` on the very next line — but only if they check
it before running anything else.
