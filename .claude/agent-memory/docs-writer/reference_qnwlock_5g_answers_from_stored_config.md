---
name: qnwlock-5g-answers-from-stored-config
description: AT+QNWLOCK="common/5g" returns a full +QNWLOCK line even on an LTE-only device with no NR leg — settled by live probe 2026-08-23, so a missing line is a failed read, never "unlocked"
metadata:
  type: reference
---

`AT+QNWLOCK="common/5g"` answers from the modem's **stored lock configuration**, not from live NR registration. Probed live on 2026-08-23 against an LTE-only device (B28 PCC + B3 SCC, no NR leg registered, SA or NSA): it returned a full `+QNWLOCK: "common/5g",0` line with rc 0, byte-structurally identical to the `common/4g` reply.

**Why:** `tower_read_nr_lock` in `scripts/usr/lib/qmanager/tower_lock_mgr.sh` used to turn a missing `+QNWLOCK:` line into `printf 'unlocked'; return 0`, while its LTE twin returned `error` / rc 1 for the same shape. That asymmetry *looks* like an empirical accommodation for devices with no NR — "maybe the command genuinely returns nothing there" — which is exactly the argument someone will make when re-reading the fix. The probe settles it: the fall-through is unreachable on a healthy read, and the asymmetry was sloppiness.

**How to apply:** if anyone proposes restoring the `unlocked` fall-through, or writes a new NR reader that treats an empty `common/5g` response as "not locked", point at this measurement. A missing `+QNWLOCK:` line is a malformed/partial response, i.e. a **failed read**. Note the locked-NR *parse* path below it is still unexercised — it needs an NR cell actually locked on an SA network — which is a separate untested code path, not a reason to add speculative handling. Written up in `docs/reference/tower-locking.md` > "The `read_ok` contract". Related: [[qcmd_failure_is_stderr_and_exit_code]], [[qnwcfg_has_no_persistence_key]].
