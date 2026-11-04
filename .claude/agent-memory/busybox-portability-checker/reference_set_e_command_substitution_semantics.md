---
name: reference_set_e_command_substitution_semantics
description: Whether `x=$(f)` where f returns nonzero triggers `set -e` exit, and how to test it when BusyBox is unavailable locally
type: reference
---

Confirmed empirically (bash and dash, 2026-08-24): `x=$(f)` where `f` returns
non-zero **DOES** trigger `set -e` to exit the enclosing shell — a bare
command-substitution assignment is NOT exempt from `-e`, unlike a command
immediately followed by `&&`/`||` (which IS exempt, e.g. `[ -n "$x" ] &&
return 0` at a module's top-of-file re-entry guard is safe under `set -e`).

This is why a library meant to be sourced under a caller's `set -e` must write
accessor calls as `val=$(fn || printf '%s' "$fallback")` — the trailing `||`
inside the subshell makes the subshell's own last-executed command exit 0,
so the outer assignment never sees a non-zero status. `val=$(fn)` alone would
abort the sourcing caller the first time `fn` legitimately returns 1.

Conversely, a function's own **direct, unguarded** call (not wrapped in
`$()`) returning non-zero WILL still abort a `set -e` caller — that's normal
and expected; it only becomes a portability bug if the callee is a library
whose contract says it may return non-zero for a non-error condition and
callers aren't told to guard it.

Testing note: **no `busybox` binary exists in this Windows/Git-Bash sandbox**
(`which busybox` → not found, silently no-ops even chained with `&&`, so a
prior "confirmed under ash" claim built on that pattern in-session was never
actually exercised — check the exit code, not just that output appeared).
`dash` IS present here and is the closest local proxy to BusyBox ash's
`set -e`/`set -u` semantics for command-substitution and pipeline behavior.
Use `dash -n` / `dash script.sh` for local pre-checks before trusting a
sourcing-under-set-e claim, but treat it as a proxy, not a substitute for the
real on-device ash when the finding is load-bearing.
