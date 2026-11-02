# S6 — quiet qcmd failures for the poller's S3-gated reads (2026-11-02)

Board: `2026-10-26-atd-poller-port.md` (PM owns it). Branch `claude/s6-qcmd-quiet-2eca03`, fast-forwarded to `c48658f3`.

## Recon

- **Writer:** the `qcmd` client, `rm520n_reply()` in `native/qmanager_atd/src/client/qcmd.rs` — `ERROR [qcmd:<pid>] Command returned ERROR: <cmd>` (and `Empty response for: <cmd>`). The broker logs the exchange as `AT_CMD` at DEBUG (`at/exec.rs`, `ok=true`), so nothing crosses the socket. `cgi_at.sh` and `qcmd_exec` are not on these paths: the three reads call `qcmd` directly.
- **RG501Q-EU** (`b7e3d6f1`, atd 0.7.4, gated poller live since 2026-11-01 22:28:59 UTC), `ERROR [qcmd` counts:
  - log.2: 42 LTE TA+MIMO, 10 QRSRP, 1 QMAP
  - log.1: 78 LTE TA+MIMO
  - log (before gate): 6 LTE TA+MIMO, 1 QMAP; (after gate, 24 min): 1 QRSRP at 22:33:04
  - Detached-radio reads by hand while attached: all four commands rc 0.
- **RM520N-GL:** SSH handshake timed out 2026-11-02; not checked.

## Plan (awaiting user OK)

1. `qcmd -q` and `QCMD_QUIET=1` (any non-empty value except `0`), parsed like `-t` / `QCMD_WAIT_MS`. Quiet demotes only the two client lines (`Command returned ERROR`, `Empty response for`) from ERROR to DEBUG. rc / stdout / stderr unchanged. Transport faults (lock refused, timeout, broker lost) keep their level. No proto change.
2. Poller: `QCMD_QUIET=1 qcmd ...` on the three gated reads only. Env form, because an older binary ignores an unknown variable but would take `-q` as the command (`invalid_command` → rc 1) if a new poller ever met an old `qcmd`.
3. Crate 0.7.5 → 0.7.6, refreshed `dependencies/qmanager_atd`, `at-command-transport.md`.

## Build (plan approved by the user 2026-11-02)

- `qcmd.rs`: `-q` (before the command, like `-t`) and `QCMD_QUIET` (non-empty, not `0`); `rm520n_reply(.., quiet)` logs the two lines at DEBUG. Usage strings name `-q`. Test: quiet keeps the verdict; env parse.
- Poller: `QCMD_QUIET=1` on the three gated reads; one comment line on `radio_attached`.
- Crate 0.7.6 (proto stays 3). `cargo test` 325 passed as user and root (WSL). armv7 musl release md5 **b2441f56** = `dependencies/qmanager_atd`.
