# Modem Bridge (`mcp__modem__*`, `mcp__modem-rg501q__*`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-26
> **RG501Q-EU (SDX55):** unverified — the device was offline when the bridge was ported; see [`platform-matrix.md`](./platform-matrix.md)

A local stdio MCP server at `tools/modem-mcp/server.ts`, ported from QManager on 2026-10-26 and
registered twice in `.mcp.json`: `modem` (`--device rm520n`) and `modem-rg501q` (`--device rg501q`).
Each holds one persistent SSH connection, reads `.env` itself (secrets never enter the transcript),
reconnects on drop and enforces per-call timeouts on the device. Prefer it over Posh-SSH.

## Setup

`cd tools/modem-mcp && bun install` once per checkout (a fresh worktree needs it too). Credentials:
`RM520N_IP` / `RM520N_SSH_USER` / `RM520N_SSH_PASSWORD` (the bare `MODEM_*` triad is the fallback)
and the `RG501Q_*` triad. `/tools/` is gitignored except `tools/modem-mcp/`.

## Device identity

On connect the server reads `androidboot.serialno` from `/proc/cmdline` and refuses the connection
if it is not the expected serial (`61368cd2` RM520N-GL, `b7e3d6f1` RG501Q-EU; override with
`<PREFIX>_SERIAL` in `.env`). A wrong-device capture therefore fails loudly instead of silently.

The SSH host key is pinned before the password is sent: `<PREFIX>_HOSTKEY_SHA256` (hex) in `.env`
if set, otherwise trust-on-first-use into the gitignored `tools/modem-mcp/.known_hosts.json`. A
mismatch refuses the connection; after a reflash, delete that device's entry.

## Tools

- `modem_exec(command, timeout_s?, stdin?)` — `{stdout, stderr, exit_code}`; default 30 s, max 600 s.
  stdin is `/dev/null` unless given. On timeout the whole process tree is stopped and killed on the
  device (tracked by an env token in `/proc/*/environ`) and the result carries `timed_out` + `orphans`.
- `modem_ps(pattern?)` / `modem_kill(pid | pattern, signal?)` — no `pkill` needed; PID 1 (systemd) is
  refused; more than 5 pattern matches need `confirm: true`.
- `modem_read(path, max_bytes?)` — content plus real size.
- `modem_write(path, content, mode?, mkdir?)` — temp file beside the target, CRLF stripped, size and
  (`.sh`) `sh -n` checked, then `sync` + rename. An existing target keeps its owner and mode
  (`www-data` owns much of `/etc/qmanager`); a new file gets `mode` or 644 / 755. Rootfs paths fail
  until `/` is remounted rw (`docs/BACKEND.md` §2.1). `mkdir: true` creates the parent as root.
- `modem_cgi(endpoint, method?, body?)` — curls `https://127.0.0.1/cgi-bin/quecmanager/<endpoint>`
  through lighttpd (plain http 301s), so the CGI runs as `www-data`. It mints a throwaway session
  file in `/tmp/qmanager_sessions/` and removes it afterwards.

## Deny-list

Refused unless the call passes `confirm: true`, which is only for an action the user explicitly
approved: `reboot` / `poweroff` / `halt` in command position, `systemctl reboot|poweroff|halt|kexec|rescue|emergency`,
`AT+CFUN=1,1`, `AT+QPOWD`, `firstboot`, factory resets, `rm -rf /`, `opkg remove`, raw `mtd` / `dd`
writes, `flash_erase` / `ubiformat` / `ubirmvol` / `mkfs`. The list is a backstop, not the rule:
service restarts and live config writes still need the user's yes (`CLAUDE.md` > Safety).

## Fallback

Posh-SSH (`New-SSHSession -Force` / `Invoke-SSHCommand`) when the bridge is unavailable; never echo
the `.env` values.
