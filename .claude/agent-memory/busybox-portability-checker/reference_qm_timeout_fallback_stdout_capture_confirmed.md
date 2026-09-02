---
name: qm_timeout_fallback_stdout_capture_confirmed
description: platform.sh's qm_timeout pure-shell fail-open branch (neither timeout binary usable) correctly preserves stdout through command substitution — verified under dash as an ash proxy
type: reference
---

Verified 2026-09-03 while validating commit 7b1ba0f (qmanager_ping adopting
qm_timeout). `qm_timeout`'s fallback branch (`platform.sh:258-282`, used only
when neither `/opt/bin/timeout` nor `/usr/bin/timeout` probes usable) runs the
wrapped command backgrounded (`"$@" &`) and always `wait`s for it — either via
the deadline-kill path (`kill -TERM` then `wait`) or the normal-completion
path (`wait "$cmd_pid" || rc=$?`) — before the function returns.

Because the child is always reaped before `qm_timeout` returns, a caller
capturing output via command substitution (`out=$(qm_timeout N cmd...)`)
correctly receives everything the child wrote to stdout: the pipe behind the
substitution doesn't see EOF until every writer (including the backgrounded
child) has closed its fd, and that closure already happened by the time
`wait` returns. Confirmed empirically under `dash` (this project's local ash
proxy — no `busybox` binary in the Windows sandbox, see
[[set_e_command_substitution_semantics]]) with both a fast command (full
output captured, rc=0) and a command that hits the deadline (empty output,
rc=124 after the 143→124 remap) — both behaved exactly as the code intends.

This fallback path is not exercised on RM520N-GL or RG501Q-EU today (both
resolve a usable `timeout` binary — see
[[rg501q_opt_bin_timeout_is_gnu_coreutils]]), so it has not been proven live
on-device, only under the dash proxy. If a future device ships with no usable
`timeout` at all, re-verify this specific path on that hardware before
trusting it blind.
