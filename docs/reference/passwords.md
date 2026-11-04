# Device Access — Web and SSH passwords (`/system-settings/device-access`)

> **Applies to:** RM520N-GL (SDX65) · added 2026-11-01 (P6, RM551E v0.1.34 parity) · not yet verified on hardware
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/{device-access/,password-card,password-change-dialog,password-input}.tsx` · namespace `public/locales/*/system-settings.json`, `device_access.*` + `passwords.*`

The Device Access page changes the two passwords that guard the modem: the **web** password (the QManager sign-in, stored in `/etc/qmanager/auth.json`) and the **SSH** password (the Linux `root` account, stored in `/etc/shadow`). One Passwords card holds both as tabs. Each tab first checks the *current* password on its own, then opens a dialog for the new one. The page replaced the old SSH Password card on the System Settings index, which asked for the **web** password to authorise a root password change; the SSH tab now asks for the current **root** password, as RM551E does.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/device-access/page.tsx` → `components/system-settings/device-access/device-access.tsx` |
| Sidebar entry | `components/app-sidebar.tsx`, `t_key: "device_access"` under System Settings |
| Card / dialog | `components/system-settings/password-card.tsx`, `password-change-dialog.tsx`, `password-input.tsx` |
| Web hook | `hooks/use-web-password.ts` → `verifyPassword()` / `changePassword()` in `hooks/use-auth.ts` |
| SSH hook | `hooks/use-ssh-password.ts` (also exports `resolvePasswordFailure`) |
| Types | `types/password-change.ts` (`PasswordActions`, `PasswordActionResult`), `types/ssh-password.ts` |
| Web endpoint | `POST /cgi-bin/quecmanager/auth/password.sh` |
| SSH endpoint | `POST /cgi-bin/quecmanager/auth/ssh_password.sh` |
| Root helper | `/usr/bin/qmanager_set_ssh_password` (source `scripts/usr/bin/`), set mode or `--verify` |
| Verify wrapper | `qm_verify_ssh_password` in `scripts/usr/lib/qmanager/cgi_auth.sh` |
| Sudoers line | `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_set_ssh_password` in `scripts/etc/sudoers.d/qmanager` |
| Capability marker | the line `# qm-capability: verify` in the helper |
| Lockout state | `/tmp/qmanager_auth_attempts.json` — shared with sign-in, see [auth-rate-limiting.md](auth-rate-limiting.md) |

The right-hand cell of the page grid holds the Web Port card — [web-port.md](web-port.md).

---

## The flow

1. The user types the current password on a tab and presses Continue. The hook posts `{"current_password":"...","verify_only":true}`.
2. On `{"success":true}` the change dialog opens. It checks the new password and its confirmation in the browser (`isPasswordValid`, `components/auth/password-requirements.tsx`) and has its own `enforce_strong` toggle.
3. The dialog posts the full change: `{"current_password":"...","new_password":"...","enforce_strong":true|false}`. The current password is checked **again** on this request; the verify step is a convenience, not a token.
4. **Web:** success destroys the session, clears the cookies and sends the browser to `/login/`. The redirect is the confirmation, so no toast. **SSH:** success toasts `passwords.ssh.toast_saved` and the web session stays.

The SSH dialog does not send `confirm_password`; the match is checked client-side. `ssh_password.sh` still honours the field when a caller sends it.

---

## Checking the current root password

**Short version: `www-data` cannot read `/etc/shadow`, so the CGI asks the root helper to do the comparison, and refuses to ask a helper that does not know how.**

`/etc/shadow` is root-only. `qm_verify_ssh_password` pipes the candidate to `sudo /usr/bin/qmanager_set_ssh_password --verify`. In that mode the helper changes nothing. It reads root's field from `/etc/shadow`, splits out `$id$salt$`, re-hashes the candidate with `openssl passwd -<id> -salt <salt> -stdin` and compares the strings.

The sudoers line names the bare path with no arguments. In sudoers that means "any arguments", so `--verify` needs no new grant.

### The capability marker (do not remove it)

> ⚠️ WARNING: a helper from before this change **ignores `--verify` and treats stdin as the NEW password**. Asking it to "verify" a wrong guess would set root's password to that guess.

So `qm_verify_ssh_password` first runs `grep -q '^# qm-capability: verify$' /usr/bin/qmanager_set_ssh_password`. No marker, no call: the function returns 1 with `QM_SSH_VERIFY_ERR=verify_unavailable`, and the endpoint answers `verify_unavailable`. It fails closed.

The new helper also refuses any first argument other than empty or `--verify` with `{"success":false,"error":"unknown_mode"}`, so a future mode can never fall through to the set path on an old helper's logic.

On an OTA the two cannot be out of step. `install_backend()` in `scripts/install_rm520n.sh` installs the shared libraries, then everything in `usr/bin/`, then the CGI tree, and a failed `usr/bin` install `die`s before the CGI tree is written. The marker guards the cases the installer does not cover: a hand-deployed CGI or `cgi_auth.sh` on a device whose helper is older.

### What the helper can verify

| Root's `/etc/shadow` field | Result |
| --- | --- |
| `$1$salt$…`, `$5$salt$…`, `$6$salt$…` | compared |
| empty, `!…`, `*…`, `x` (no password or locked) | `no_password_set` |
| any other `$id$` (yescrypt, bcrypt…) | `root_hash_unsupported` |
| `$5$rounds=…$` / `$6$rounds=…$` | `root_hash_unsupported` |
| `openssl` not on `PATH=/usr/sbin:/usr/bin:/sbin:/bin` | `hash_tool_missing` |
| `/etc/shadow` missing | helper says `no_shadow`; the CGI reports `verify_unavailable` |

QManager's own set path writes `$6$` (or `$1$` as a fallback) with a plain 16-hex salt and no `rounds=`, so any password QManager set can be verified.

> ℹ️ NOTE: a root account with no password (`no_password_set`) cannot be changed from this tab, because there is no current password to check. The setup wizard sets root's password ([onboarding.md](onboarding.md)), and a fresh install sets a random one ([qmanager-independence.md](qmanager-independence.md#ssh-password-management)).

---

## dropbear reads `/opt/etc/shadow`, not `/etc/shadow`

Entware's dropbear looks accounts up through Entware's libc, which reads `/opt/etc/passwd` and `/opt/etc/shadow`. The helper writes `/etc/shadow`, so SSH only sees the new password while `/opt/etc/shadow` is a symlink to `/etc/shadow`. Without the link every password is rejected, yet the helper and the SSH tab still report success (issue #23).

- The Entware bootstrap in `install_dependencies()` links `passwd group shells shadow gshadow`, but only the ones that exist at that moment.
- `ensure_entware_account_links()` in `install_rm520n.sh` repeats that on every install and OTA (called unconditionally from `main()`, before `setup_ssh_early`). It acts only when `/opt` is a mount point in `/proc/self/mountinfo`. It creates a missing link, replaces a wrong or dangling one, and leaves a regular file alone with a warning.
- The System Health Check test `perm.opt_account_links` fails when `shadow` is not linked and warns for the other four.
- Uninstall leaves the links: they belong to the Entware bootstrap, and Entware's dropbear and sudo still need them.

Verified 2026-11-03 on both devices. With the link removed, SSH password login was rejected; after the function ran it worked.

---

## Both endpoints share the sign-in lockout

Each endpoint runs `qm_check_rate_limit` before checking the current password, and `qm_record_failed_attempt` after a wrong one. It is the same state file the login form reads. **A wrong SSH password counts toward the web sign-in lockout**, and the reverse. Without this, a signed-in session would be a free oracle for guessing root's password.

Only `invalid_password` records a failure. `no_password_set`, `hash_tool_missing`, `root_hash_unsupported` and `verify_unavailable` do not, because they say nothing about the guess. A correct current password calls `qm_clear_attempts`.

The card shows the remaining guesses. `resolvePasswordFailure()` renders `passwords.errors.invalid_password` with `count` when `attempts_remaining > 0`, and `passwords.errors.rate_limited` with the `retry_after` seconds. At `attempts_remaining: 0` it falls back to the plain line, as the login form does — zero means "the next wrong guess locks", not "no tries left" (see [auth-rate-limiting.md](auth-rate-limiting.md#gotcha-attempts_remaining-0-on-an-unlocked-form)).

---

## Password rule

Both endpoints apply the P0b rule to the new password, and skip it in `verify_only` mode:

| Check | Applies | Failure |
| --- | --- | --- |
| At least 6 bytes (`wc -c`) | always | `password_weak` |
| Upper + lower + digit (`qm_password_is_strong`) | unless `enforce_strong` is literally `false`; absent means `true` | `password_weak` |

The helper re-checks length on its set path (6–128 bytes) and now also answers `password_weak` below 6, not `password_too_short`.

---

## Error codes

All refusals are `{"success":false,"error":"<code>","detail":"<English>"}`. Every code in this table has an `errors.json` key.

| Code | `password.sh` | `ssh_password.sh` | Extra fields |
| --- | --- | --- | --- |
| `missing_fields` | yes | yes | |
| `password_weak` | yes | yes | |
| `password_mismatch` | — | yes, only when `confirm_password` is sent | |
| `rate_limited` | HTTP 429 | HTTP 429 | `retry_after`, `attempts_remaining` |
| `invalid_password` | yes | yes | `attempts_remaining` |
| `no_password_set` | — | yes | |
| `hash_tool_missing` | — | yes | |
| `root_hash_unsupported` | — | yes | |
| `verify_unavailable` | — | yes | |
| `save_failed` | yes (writing `auth.json`) | — | |
| `passwd_failed` | — | yes (the helper's set path failed) | |

`ssh_password.sh` used to answer `password_too_short` and `ssh_password_failed`. It no longer emits either; `ssh_password_failed` keeps its `errors.json` key for older backends.

`no_password_set` and `hash_tool_missing` have no other emitter, so their `errors.json` copy was rewritten for the SSH path.

---

## Related

- [auth-rate-limiting.md](auth-rate-limiting.md) — the lockout ladder, `qm_password_is_strong`, the login endpoint
- [qmanager-independence.md](qmanager-independence.md#ssh-password-management) — the helper's set path, the install-time random root password, the sudoers drop-in
- [onboarding.md](onboarding.md) — the setup wizard, which syncs the first web password to root
- [system-settings.md](system-settings.md) — the index the old SSH Password card was removed from
