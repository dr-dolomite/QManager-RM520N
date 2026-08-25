# Tailscale SSH Toggle — Design Spec

**Date:** 2026-05-10
**Branch:** `dev-rm520`
**Reference:** `simpleadmin-source/RMxxx_rgmii_toolkit.sh:522` (the original `tailscale up --ssh --accept-dns=false --reset` line)

## Background

Tailscale ships a built-in SSH server inside the `tailscaled` daemon. When enabled, tailnet members can SSH into this device using identities and ACLs configured in the Tailscale admin panel. It bypasses the device's own `sshd` (dropbear) entirely — no system-level SSH config changes are needed.

The original SimpleAdmin toolkit exposed this as a single menu item that ran `tailscale up --ssh --accept-dns=false --reset`. QManager's current Tailscale implementation has no SSH affordance. This spec adds a Tailscale SSH switch to the existing Tailscale Connection card.

## Constraint: `--reset` wipes preferences

QManager's `connect` action runs `tailscale up --reset --accept-dns=false` (`scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh:333`). The `--reset` flag clears all preferences in `tailscaled.state` on every connect — including any SSH preference set previously. This means a one-shot `tailscale set --ssh=true` does not survive a reconnect.

We work around this by storing the user's SSH intent in a QManager-owned flag file, and making the connect path flag-aware.

## Architecture

Three pieces:

1. **Persisted intent flag.** `/etc/qmanager/tailscale_ssh` containing `1` or `0`. Atomic writes via `.tmp` + `mv`. This is the source of truth for user intent.
2. **Connect path becomes flag-aware.** `tailscale.sh` `connect` action reads the flag and conditionally appends `--ssh` to its existing `tailscale up` invocation.
3. **Live toggle action.** New `set_ssh` POST action writes the flag, then runs `tailscale set --ssh=true|false` to apply immediately if the daemon is running. If the daemon is stopped, only the flag is written; it gets honored on next connect.

### Why this design

- **Survives `--reset`:** the flag is read every time we connect, so SSH is reapplied after any reconnect.
- **Survives reboot:** Tailscale's own `tailscaled.state` already persists `RunSSH` across reboots, so SSH stays on without QManager doing anything. The flag is the failsafe for when `--reset` would otherwise wipe it.
- **Survives uninstall + reinstall:** `qmanager_tailscale_mgr uninstall` removes the flag file — fresh installs start with SSH off, requiring explicit opt-in.
- **Decoupled from connect state:** user can flip the switch when the daemon is stopped; the flag updates immediately and SSH activates on next connect.

## Data Flow

### Toggle on, daemon running

```
User flips switch → confirm dialog → POST {action: "set_ssh", enabled: true}
  → CGI writes /etc/qmanager/tailscale_ssh = "1"
  → CGI runs `tailscale set --ssh=true`
  → CGI returns {success: true}
  → hook refetches status → switch reflects new state
```

### Toggle on, daemon stopped

```
User flips switch → confirm dialog → POST {action: "set_ssh", enabled: true}
  → CGI writes /etc/qmanager/tailscale_ssh = "1"
  → CGI returns {success: true, pending: true, message: "..."}
  → toast: "Tailscale SSH will activate on next connect"
```

### Connect with SSH preference enabled

```
User clicks Connect → POST {action: "connect"}
  → CGI reads flag → flag is "1"
  → CGI runs `tailscale up --reset --accept-dns=false --ssh`
  → poll for auth_url or "Success" → return as today
```

### Disable while connected (no dialog)

```
User flips switch off → POST {action: "set_ssh", enabled: false}
  → CGI writes flag = "0"
  → CGI runs `tailscale set --ssh=false`
  → CGI returns {success: true}
  → toast: "Tailscale SSH disabled"
```

## File Changes

**Modified (3 files):**

### `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`

- New constant near the top: `SSH_PREF_FILE="/etc/qmanager/tailscale_ssh"`.
- New helper `get_ssh_pref()` — reads the flag; returns `true` if file contains `1`, otherwise `false`.
- GET response gains one field:
  - `ssh_enabled` — value of `get_ssh_pref()` (user intent; always present once installed). The UI uses this for the switch state and derives the "Pending" condition from it plus existing connect state — no separate `ssh_active` field is needed (avoids a fragile dependency on `tailscale debug prefs` or parsing the bbolt-backed `tailscaled.state`).
- New POST action `set_ssh`:
  - Validates `enabled` is `true` or `false`.
  - Atomically writes `/etc/qmanager/tailscale_ssh` (`.tmp` + `mv`).
  - If `is_daemon_running`, runs `ts_cmd set --ssh=true|false`. On failure, rolls back the flag and returns `{success: false, error: "set_failed", detail: <stderr>}`.
  - Else returns `{success: true, pending: true, message: "..."}`.
- Connect path edit (around line 333):
  - Reads `SSH_PREF_FILE` before invoking `tailscale up`.
  - If pref is `1`, appends `--ssh` to args.
  - Single-line comment noting the flag-aware behavior.

### `hooks/use-tailscale.ts`

- `TailscaleStatus` gains `ssh_enabled?: boolean`.
- `UseTailscaleReturn` gains `setSshEnabled: (enabled: boolean) => Promise<boolean>` and `isTogglingSsh: boolean`.
- New action method calls `postAction({action: "set_ssh", enabled})`, refetches status, surfaces error via existing `setError` path.

### `components/monitoring/tailscale/tailscale-connection-card.tsx`

- New `sshToggle` element, sibling of `bootToggle`. Switch labeled "Tailscale SSH" with helper text "Allow tailnet members to SSH into this device based on your admin-panel ACLs."
- Switch is disabled when `!daemonRunning || backendState !== "Running"`. Disabled state shows a `Tooltip` with "Connect to Tailscale to enable SSH."
- "Pending" indicator (small muted text "Pending — applies on next connect") when `ssh_enabled === true` and the node isn't fully connected (`!daemonRunning || backendState !== "Running"`). This is the case where the user enabled SSH but the daemon isn't up to apply it; on next connect the flag-aware connect path will include `--ssh` automatically.
- New `<AlertDialog>` for the enable confirmation. Title: "Enable Tailscale SSH?". Description explains tailnet members will be able to SSH in based on admin-panel ACLs and recommends reviewing the ACL policy. Cancel / "Enable SSH" actions.
- Disable path: no dialog; direct toast confirmation.
- Render `sshToggle` after `bootToggle` in every state branch (Stopped, NeedsLogin, Running, Disconnected).

**Helper script — `scripts/usr/bin/qmanager_tailscale_mgr`:**

- `do_uninstall` adds `rm -f /etc/qmanager/tailscale_ssh` so a fresh install starts with SSH off.

**No new files. No sudoers changes** — `qmanager_tailscale_mgr` and `tailscale` invocations already work via the existing `$_SUDO` plumbing in `tailscale.sh`.

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Toggle while daemon stopped | Flag written, `pending: true` returned, toast says "applies on next connect". |
| `tailscale set --ssh` fails (rare race) | Roll back flag write, return `{success: false, error: "set_failed", detail}`. UI shows error toast and reverts switch via refetch. |
| `tailscale up --ssh` fails during connect | Falls through to existing connect error handling — auth_url poll either finds the URL or times out. No new code path. |
| Flag file corrupted / unreadable | Defaults to `false`. Off is the safe default. |
| `tailscale set --ssh` unsupported (old binary) | Defensive check via `tailscale set --help`; graceful error returned. Not expected to fire — current pinned version is 1.92.5. |
| Reboot | Tailscale's own state file persists `RunSSH`. QManager flag is the failsafe for the next `--reset` connect. |
| Logout / disconnect | Flag preserved. Matches how `enabled_on_boot` survives state changes. |
| Uninstall | Flag file removed by helper. Reinstall starts with SSH off — explicit opt-in. |
| Switch spam | `isTogglingSsh` disables the switch during the in-flight request. Matches the existing `setBootEnabled` pattern. |
| ACL misconfigured server-side | Out of scope. Confirm dialog directs user to review their Tailscale admin-panel ACL. |

## Test Plan

Manual verification on hardware (no automated test harness exists for QManager CGI/React on this branch):

1. **Fresh install → enable SSH while connected.** Install + connect + authenticate. Flip switch on, confirm dialog. Verify toast, switch stays on, flag file = `1`, external tailnet device can `ssh root@<hostname>`.
2. **Disable SSH while connected.** Flip switch off (no dialog). Verify flag file = `0`, external SSH attempt fails.
3. **Toggle while daemon stopped.** Stop service, flip switch on. Verify "Pending" indicator, toast, flag = `1`. Start + connect, verify SSH live.
4. **Persistence across `--reset` reconnect.** SSH on + connected → Disconnect → Connect. Verify SSH stays on (flag was read, `--ssh` was appended).
5. **Persistence across reboot.** SSH on + `enabled_on_boot=true` → reboot. Verify switch reads on after boot, SSH access works.

**Pre-merge static checks:** `bunx tsc --noEmit`; `bash -n` on the CGI script; lint on the component.

**Regression watch after future Tailscale version bumps:** scenarios 1 + 4 catch syntax/semantics changes in `tailscale set --ssh` and `tailscale up --ssh`/`--reset`.

## Out of Scope

- **Dropbear / system sshd changes.** No modifications to the device's regular SSH server; both paths remain available.
- **Tailscale ACL editing from QManager.** ACLs live in the admin panel; QManager surfaces a docs link in the confirm dialog and stops there.
- **Per-user SSH controls.** Tailscale SSH is a single daemon-level toggle; per-tailnet-user controls are an ACL concern.
- **Automated test harness.** QManager has no CGI/React test infrastructure on this branch; adding one is its own initiative.
